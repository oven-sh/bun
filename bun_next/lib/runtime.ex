defmodule BunNext.Runtime do
  use GenServer
  require Logger

  def start_link(opts \\ []) do
    parent = self()
    GenServer.start_link(__MODULE__, [parent: parent] ++ opts)
  end

  def eval(pid, code) do
    GenServer.call(pid, {:eval, code}, 15000)
  end

  def handle_call(:get_runtime, _from, state), do: {:reply, state.runtime, state}
  def handle_call({:eval, code}, _from, state) do
    result = BunNext.Native.eval_js(state.runtime, code)
    {:reply, result, state}
  end

  def init(opts) do
    parent = Keyword.get(opts, :parent)
    worker_parent_pid = Keyword.get(opts, :worker_parent_pid)
    runtime = BunNext.Native.init_runtime()
    
    # Si on est un worker, on s'enregistre auprès du parent
    if worker_parent_pid do
      send(worker_parent_pid, {:worker_started, self()})
    end

    {:ok, %{runtime: runtime, parent: parent, worker_parent_pid: worker_parent_pid, processes: %{}, workers: %{}}}
  end

  # Gestion des messages
  def handle_info(msg, state) when is_binary(msg) do
    case Jason.decode(msg) do
      {:ok, %{"type" => "worker_spawn", "filename" => filename, "id" => id}} ->
        Logger.info("Démarrage d'un Worker Thread pour #{filename}")
        {:ok, worker_pid} = BunNext.Runtime.start_link(worker_parent_pid: self())
        
        case BunNext.Bundler.bundle(filename) do
          {:ok, code} ->
            # On informe le worker de son identité
            BunNext.Runtime.eval(worker_pid, "globalThis.__is_worker = true;")
            BunNext.Runtime.eval(worker_pid, code)
            {:noreply, %{state | workers: Map.put(state.workers, id, worker_pid)}}
          _ -> {:noreply, state}
        end

      {:ok, %{"type" => "worker_post_message", "id" => id, "data" => data}} ->
        if pid = Map.get(state.workers, id), do: send(pid, {:message_from_parent, data})
        {:noreply, state}

      {:ok, %{"type" => "parent_post_message", "data" => data}} ->
        if state.worker_parent_pid, do: send(state.worker_parent_pid, {:message_from_worker, self(), data})
        {:noreply, state}

      {:ok, %{"type" => "http_server_start", "port" => port}} ->
        BunNext.HttpServer.start_link(self(), port)
        {:noreply, state}

      {:ok, %{"type" => "timer_start", "delay" => delay, "id" => id}} ->
        Process.send_after(self(), Jason.encode!(%{type: "timer_done", id: id}), delay)
        {:noreply, state}

      {:ok, %{"type" => "timer_done", "id" => id}} ->
        BunNext.Native.eval_js(state.runtime, "globalThis.__resolve_timer('#{id}');")
        {:noreply, state}

      {:ok, %{"type" => "http_response", "id" => id, "status" => s, "body" => b, "headers" => h}} ->
        if w = Map.get(state.processes, id) do
           send(w, {:http_response, id, s, b, h})
           {:noreply, %{state | processes: Map.delete(state.processes, id)}}
        else {:noreply, state} end

      {:ok, %{"type" => "fetch", "url" => url, "id" => id} = opts} ->
        handle_fetch(url, id, state.runtime, opts)
        {:noreply, state}

      {:ok, %{"type" => "spawn", "cmd" => cmd, "args" => args, "id" => id}} ->
        port = Port.open({:spawn, "#{cmd} #{Enum.join(args, " ")}"}, [:binary, :exit_status, :stderr_to_stdout])
        {:noreply, %{state | processes: Map.put(state.processes, port, id)}}

      {:ok, _} ->
        if state.parent, do: send(state.parent, msg)
        {:noreply, state}

      _ -> {:noreply, state}
    end
  end

  def handle_info({:worker_started, _pid}, state), do: {:noreply, state}
  
  def handle_info({:message_from_parent, data}, state) do
    BunNext.Native.eval_js(state.runtime, "globalThis.__handle_worker_message(#{Jason.encode!(data)});")
    {:noreply, state}
  end

  def handle_info({:message_from_worker, worker_pid, data}, state) do
    worker_id = Enum.find_value(state.workers, fn {id, pid} -> if pid == worker_pid, do: id end)
    if worker_id, do: BunNext.Native.eval_js(state.runtime, "globalThis.__handle_parent_message('#{worker_id}', #{Jason.encode!(data)});")
    {:noreply, state}
  end

  def handle_info({:http_request_delegated, payload}, state) do
    BunNext.Native.eval_js(state.runtime, "globalThis.__handle_http_request(#{Jason.encode!(Map.delete(payload, :waiter))});")
    {:noreply, %{state | processes: Map.put(state.processes, payload.id, payload.waiter)}}
  end

  def handle_info({port, {:data, data}}, state) do
    if id = Map.get(state.processes, port), do: BunNext.Native.eval_js(state.runtime, "globalThis.__resolve_process('#{id}', 'stdout', '#{escape_js_string(data)}');")
    {:noreply, state}
  end

  def handle_info({port, {:exit_status, status}}, state) do
    if id = Map.get(state.processes, port) do
      BunNext.Native.eval_js(state.runtime, "globalThis.__resolve_process('#{id}', 'close', #{status});")
      {:noreply, %{state | processes: Map.delete(state.processes, port)}}
    else {:noreply, state} end
  end

  defp handle_fetch(url, id, runtime, opts) do
    Task.start(fn ->
      try do
        case Req.request(method: opts["method"] |> String.downcase() |> String.to_atom(), url: url, headers: opts["headers"] || %{}, body: opts["body"]) do
          {:ok, %{status: status, body: res_body}} when status in 200..299 ->
            data = if is_binary(res_body), do: res_body, else: Jason.encode!(res_body)
            BunNext.Native.push_binary(runtime, id, data)
            BunNext.Native.eval_js(runtime, "globalThis.__resolve_fetch('#{id}', null, null);")
          _ -> BunNext.Native.eval_js(runtime, "globalThis.__resolve_fetch('#{id}', null, 'Error');")
        end
      rescue _ -> :ok end
    end)
  end

  defp escape_js_string(str), do: str |> String.replace("\\", "\\\\") |> String.replace("'", "\\'") |> String.replace("\n", "\\n") |> String.replace("\r", "\\r")
end

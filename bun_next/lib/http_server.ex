defmodule BunNext.HttpServer do
  @moduledoc """
  Orchestrateur du serveur HTTP Bun-Elixir déléguant à Bandit.
  """
  use Plug.Router
  require Logger

  plug :match
  plug :dispatch

  def start_link(runtime_pid, port) do
    Application.put_env(:bun_next, :active_runtime, runtime_pid)
    Bandit.start_link(plug: __MODULE__, port: port)
  end

  def init(opts), do: opts

  match _ do
    runtime_pid = Application.get_env(:bun_next, :active_runtime)
    request_id = :crypto.strong_rand_bytes(8) |> Base.encode16()
    
    # 1. Notifier le Runtime (GenServer) de la requête, en passant le PID actuel (celui qui attend)
    payload = %{
      type: "http_request_internal",
      id: request_id,
      method: conn.method,
      url: conn.request_path,
      headers: Enum.into(conn.req_headers, %{}),
      waiter: self()
    }
    
    send(runtime_pid, {:http_request_delegated, payload})

    # 2. Attendre la réponse
    receive do
      {:http_response, ^request_id, status, body, headers} ->
        conn
        |> put_resp_headers(headers)
        |> send_resp(status, body)
    after
      30000 ->
        send_resp(conn, 504, "Gateway Timeout")
    end
  end

  defp put_resp_headers(conn, headers) do
    Enum.reduce(headers, conn, fn {k, v}, c -> 
      Plug.Conn.put_resp_header(c, String.downcase(to_string(k)), to_string(v)) 
    end)
  end
end

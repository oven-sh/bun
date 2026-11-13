defmodule BunNext.Package do
  defstruct [:name, :version, dependencies: %{}, dev_dependencies: %{}]
end

defmodule BunNext.Module do
  defstruct [:path, :source]
end

defmodule BunNext.Native do
  use Rustler, otp_app: :bun_next, crate: "native"

  def parse_package_json(_path), do: :erlang.nif_error(:nif_not_loaded)
  def save_to_cache(_name, _version, _data), do: :erlang.nif_error(:nif_not_loaded)
  def resolve_deps(_root_deps, _registry), do: :erlang.nif_error(:nif_not_loaded)
  def transpile_ts(_code), do: :erlang.nif_error(:nif_not_loaded)
  def extract_tgz(_tgz_path, _dest_path), do: :erlang.nif_error(:nif_not_loaded)
  def bundle_simple(_entry_path), do: :erlang.nif_error(:nif_not_loaded)
  def run_js(_code), do: :erlang.nif_error(:nif_not_loaded)
  def init_runtime(), do: :erlang.nif_error(:nif_not_loaded)
  def eval_js(_resource, _code_binary), do: :erlang.nif_error(:nif_not_loaded)
  def push_binary(_resource, _id, _data_binary), do: :erlang.nif_error(:nif_not_loaded)
  def load_native_module(_resource, _path), do: :erlang.nif_error(:nif_not_loaded)
end

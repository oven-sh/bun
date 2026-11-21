defmodule BunNext do
  @moduledoc """
  Documentation for `BunNext`.
  """

  @doc """
  Hello world.

  ## Examples

      iex> BunNext.hello()
      :world

  """
  def hello do
    :world
  end

  def fetch_package_metadata(name) do
    url = "https://registry.npmjs.org/#{name}"
    case Req.get(url) do
      {:ok, %{status: 200, body: body}} -> {:ok, body}
      {:ok, %{status: status}} -> {:error, "Status #{status}"}
      {:error, reason} -> {:error, reason}
    end
  end
end

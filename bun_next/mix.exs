defmodule BunNext.MixProject do
  use Mix.Project

  def project do
    [
      app: :bun_next,
      version: "0.1.0",
      elixir: "~> 1.18",
      start_permanent: Mix.env() == :prod,
      deps: deps(),
      escript: [main_module: BunNext.CLI, name: "bun-ex"]
    ]
  end

  # Run "mix help compile.app" to learn about applications.
  def application do
    [
      extra_applications: [:logger]
    ]
  end

  # Run "mix help deps" to learn about dependencies.
  defp deps do
    [
      {:rustler, "~> 0.36.1", runtime: false},
      {:jason, "~> 1.4"},
      {:req, "~> 0.5.0"},
      {:bandit, "~> 1.0"},
      {:plug, "~> 1.14"}
    ]
  end
end

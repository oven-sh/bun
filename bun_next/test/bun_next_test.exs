defmodule BunNextTest do
  use ExUnit.Case
  doctest BunNext

  test "greets the world" do
    assert BunNext.hello() == :world
  end
end

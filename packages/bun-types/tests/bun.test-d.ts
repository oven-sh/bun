import { BunPlugin } from "bun";
import * as tsd from "tsd";
{
  const _plugin: BunPlugin = {
    name: "asdf",
    setup() {},
  };
  _plugin;
}
{
  const arg = Bun.plugin({
    name: "arg",
    setup() {},
  });

  tsd.expectType<void>(arg);
}

{
  const arg = Bun.plugin({
    name: "arg",
    async setup() {},
  });

  tsd.expectType<Promise<void>>(arg);
}

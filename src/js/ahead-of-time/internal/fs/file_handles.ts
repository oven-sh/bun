// A module of compiled programs alone: `bun run` has no text under this name and never loads it.
// test/internal/second-texts-of-modules.test.ts holds that no text outside this folder asks for it.

type Internals = $BunModules["node:fs/promises"]["$data"];

const fileHandles: {
  internals: Internals | undefined;
  whenLoaded: ((internals: Internals) => void) | undefined;
} = {
  internals: undefined,
  whenLoaded: undefined,
};

export default fileHandles;

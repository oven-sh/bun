type Internals = $BunModules["node:fs/promises"]["$data"];

const fileHandles: {
  internals: Internals | undefined;
  whenLoaded: ((internals: Internals) => void) | undefined;
} = {
  internals: undefined,
  whenLoaded: undefined,
};

export default fileHandles;

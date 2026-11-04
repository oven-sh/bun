// Making process.stdout or process.stderr loads all of node:stream, which adds members to what its parts define. The light streams that a compiled program may have
// in their place (builtins/stdio.ts) load none of it: where a part is loaded already, they ask here for the rest.
export default {
  /** Stored by the first part that is loaded. */
  rest: undefined as undefined | (() => void),
};

const isInsideNodeModules = $newZigFunction("node_util_binding.zig", "isInsideNodeModules", 0);

function shouldColorize(stream) {
  if (process.env.FORCE_COLOR !== undefined) {
    return require("internal/tty").getColorDepth() > 2;
  }
  return stream?.isTTY && (typeof stream.getColorDepth === "function" ? stream.getColorDepth() > 2 : true);
}

export default {
  isInsideNodeModules,
  shouldColorize,
};

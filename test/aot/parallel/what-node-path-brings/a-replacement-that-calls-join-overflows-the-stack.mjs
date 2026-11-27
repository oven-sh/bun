// The calls of a module are tail calls, so only the frames of join() make the stack grow.
import path from "node:path";
for (const platform of [path.posix, path.win32]) {
  const { normalize } = platform;
  for (const replacement of [text => platform.join(text), text => platform.join(text, ""), platform.join]) {
    platform.normalize = replacement;
    try {
      platform.join("a", "b");
    } catch (error) {
      console.log(error.name);
    }
  }
  platform.normalize = normalize;
}

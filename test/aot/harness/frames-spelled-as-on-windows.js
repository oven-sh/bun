// Loaded in front of a program: the stack of an error names each file as Windows spells it, with a drive and `\` between the folders.
Error.prepareStackTrace = (error, sites) => {
  let stack = Error.prototype.toString.call(error);
  for (const site of sites) {
    const file = site.getFileName();
    const frame = String(site);
    stack += "\n    at " + (file?.startsWith("/") ? frame.replace(file, "C:" + file.replaceAll("/", "\\")) : frame);
  }
  return stack;
};

// The program assigns a name of its own to process.platform, takes it out of process by a pattern and names a file by it.
// In such a name the build takes the platform for the one that the executable is built for, so the executable holds that file and not the other, and require() says that it did not find it.
process.platform = "made-up";
const { platform } = process;
console.log(platform);
try {
  console.log(require(`./part.${platform}.cjs`).name);
} catch (error) {
  console.log(error.code);
}

// The build reads the name and finds no file under it. Where the call runs, the text goes to the loader of the host, which words the error: the loader is held.
try {
  require(__filename.replace("a-name-that-finds-no-file-goes-to-the-loader-of-the-host.cjs", "nowhere.cjs"));
} catch (error) {
  console.log(error.code);
}
import("./nowhere-else.mjs").catch(error => console.log(error.code ?? error.name));

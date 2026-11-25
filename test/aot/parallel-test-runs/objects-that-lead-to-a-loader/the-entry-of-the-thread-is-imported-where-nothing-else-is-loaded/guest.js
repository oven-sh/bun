async function run() {
  const main = "bun:main";
  try {
    const loaded = await import(main);
    postMessage(typeof loaded + " " + Object.keys(loaded).length);
  } catch (error) {
    postMessage("it throws " + error.code);
  }
}
void run();

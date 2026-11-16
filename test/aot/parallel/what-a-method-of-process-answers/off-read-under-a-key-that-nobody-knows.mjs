// The answer is read under a key that the build cannot know.
const held = process.off("madeUp", () => {});
console.log(typeof held[JSON.parse('"allowedNodeEnvironmentFlags"')].has);

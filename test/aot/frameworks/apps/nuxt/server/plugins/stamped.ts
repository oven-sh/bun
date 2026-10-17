export default defineNitroPlugin(nitro => {
  nitro.hooks.hook("beforeResponse", event => { setResponseHeader(event, "x-made-by", getResponseHeader(event, "x-made-by") ?? "a nitro plugin"); });
});

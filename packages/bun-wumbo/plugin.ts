// Experiment
export default {
  name: "wumboplugin",
  setup({ unstable_devServer: devServer }) {
    devServer.addRoutes({
      "/_bun/plugin/wumbo/endpoint1": (req: Request) => {
        return new Response("Hello, world!");
      },
      "/_bun/plugin/wumbo/endpoint2": (req: Request) => {
        return new Response("Hello, world!");
      },
    });

    devServer.onEvent("wumbo:data", data => {
      // import.meta.hot.send("wumbo:data", data)
      devServer.send("wumbo:meow", data); // import.meta.hot.on("wumbo:meow", () => {})
      console.log(data);
    });

    devServer.onEvent("bun:buildError", errors => {
      console.error("errs", { errors }); // array of BuildMessage
    });
    devServer.onEvent("bun:browserError", errors => {
      console.error("errs", { errors }); // object of { name: string, message: string, stack: string }
    });
    devServer.onEvent("bun:successfulBuild", () => {
      console.log("successfulBuild");
    });
    devServer.onEvent("bun:buildStart", () => {
      console.log("buildStart"); // buildEnd is either buildError or successfulBuild
    });
    process.on("uncaughtException", error => {
      console.error("uncaughtException", { error });
    });
  },
};

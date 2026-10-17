import { bootstrapApplication, type BootstrapContext } from "@angular/platform-browser";
import { App } from "./app/app";
import { config } from "./app/app.config.server";

export default (context: BootstrapContext) => bootstrapApplication(App, config, context);

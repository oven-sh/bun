import { provideHttpClient, withFetch } from "@angular/common/http";
import { type ApplicationConfig, provideBrowserGlobalErrorListeners } from "@angular/core";
import { provideClientHydration } from "@angular/platform-browser";
import { provideRouter, withComponentInputBinding } from "@angular/router";
import { routes } from "./app.routes";

export const appConfig: ApplicationConfig = {
  providers: [provideBrowserGlobalErrorListeners(), provideRouter(routes, withComponentInputBinding()), provideClientHydration(), provideHttpClient(withFetch())],
};

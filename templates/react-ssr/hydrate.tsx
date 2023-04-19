const { default: App } = await import(globalThis.PATH_TO_PAGE);
console.log(App);
import { hydrateRoot } from "react-dom/client";

hydrateRoot(document, <App />);

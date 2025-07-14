/*
 * This file is the entry point for the React app, it sets up the root
 * element and renders the App component to the DOM.
 *
 * It is included in `src/index.html`.
 */

import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "./app";

const root = document.getElementById("root")!;

const app = (
  <StrictMode>
    <App />
  </StrictMode>
);

// Unlike other build tools, Bun will dead-code-eliminate usage of
// `import.meta.hot` and the other HMR APIs in production builds.
((import.meta.hot.data as { root?: Root }).root ??= createRoot(root)).render(app);

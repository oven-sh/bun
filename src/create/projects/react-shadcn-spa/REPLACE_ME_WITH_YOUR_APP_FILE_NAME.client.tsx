import { createRoot } from "react-dom/client";
import * as App from "./REPLACE_ME_WITH_YOUR_APP_BASE_NAME";
import React from "react";

const Component = App.default || App["REPLACE_ME_WITH_YOUR_APP_BASE_NAME"];

function mount(root: HTMLElement) {
  createRoot(root).render(
    <React.StrictMode>
      <Component />
    </React.StrictMode>,
  );
}

let root = document.getElementById("root");
if (root) {
  mount(root);
} else {
  document.addEventListener("DOMContentLoaded", () => {
    root = document.getElementById("root");
    if (root) {
      mount(root);
    } else {
      throw new Error("No root element found");
    }
  });
}

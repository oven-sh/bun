import { createRoot } from "react-dom/client";
import { App } from "./App";

// Initialize React as soon as possible
const root = createRoot(document.getElementById("root")!);
root.render(<App />);

import { APITester } from "./APITester";
import "./index.css";

import logo from "./logo.svg";
import reactLogo from "./react.svg";

export function App() {
  return (
    <div className="app">
      <div className="logo-container">
        <a href="https://bun.sh" target="_blank">
          <img src={logo} alt="Bun Logo" className="logo bun-logo" />
        </a>
        <a href="https://react.dev" target="_blank">
          <img src={reactLogo} alt="React Logo" className="logo react-logo" />
        </a>
      </div>

      <h1>Bun + React</h1>
      <p>
        Edit <code>src/App.tsx</code> and save to test HMR
      </p>
      <APITester />
    </div>
  );
}

export default App;

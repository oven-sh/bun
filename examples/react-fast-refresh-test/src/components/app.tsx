import * as React from "react";
import { Button } from "./Button";
import { RenderCounter } from "./RenderCounter";
export function App() {
  return (
    <RenderCounter name="App">
      <div className="AppRoot">
        <h1>This is the root element</h1>

        <Button>Click</Button>
      </div>
    </RenderCounter>
  );
}

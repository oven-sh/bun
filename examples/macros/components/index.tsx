import * as ReactDOM from "react-dom";
import * as React from "react";
import { IPAddresses } from "./example";

const Start = function () {
  const root = document.createElement("div");
  document.body.appendChild(root);

  ReactDOM.render(<IPAddresses />, root);
};

Start();

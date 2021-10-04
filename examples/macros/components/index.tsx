import * as ReactDOM from "react-dom";
import * as React from "react";
import { IPAddresses } from "./example";
import { Covid19 } from "./covid19";

const Start = function () {
  const root = document.createElement("div");
  document.body.appendChild(root);

  // comment out to switch between examples
  // ReactDOM.render(<IPAddresses />, root);
  ReactDOM.render(<Covid19 />, root);
};

Start();

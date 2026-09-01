import * as babel from "@babel/standalone";
import fastify from "fastify";
import { renderToString } from "react-dom/server";
import React from "react";
console.log(typeof babel.transform, typeof fastify, renderToString(React.createElement("div", null, "hi")));

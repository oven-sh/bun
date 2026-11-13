import { vi } from "vitest";
import "./helper.js";
import { ant } from "./ant.js";
export const launch = () => [ant()].join(" / ");

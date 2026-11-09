import "./before.js";
import vitest, { assert, vi } from "vitest";
import "./after.js";
export const value = [assert(), vi, vitest].join(", ");

import { mock } from "bun:test";
import "flour";
mock.module("flour", () => ({ grain: "of the preload" }));

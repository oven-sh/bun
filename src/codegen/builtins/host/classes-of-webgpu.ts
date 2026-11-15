import * as schema from "../../../runtime/webgpu/webgpu.bind.ts";
import { ClassType } from "../../bindgen-lib-internal.ts";

export const classesOfWebGPU = Object.entries(schema)
  .filter(([, type]) => type instanceof ClassType)
  .map(([name]) => name);

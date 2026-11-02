import data, { title } from "./data.json";
import * as namespace from "./data.json";
export const seen = [data.count, title, Object.keys(namespace), namespace.count];

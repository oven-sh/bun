import given from "./carried.json" with { type: "file" };
import * as whole from "./carried.json" with { type: "file" };
export { given as again, whole };
export const kept = given;
export default given;

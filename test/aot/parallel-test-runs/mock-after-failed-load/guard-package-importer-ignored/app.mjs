import { connect } from "./connect.mjs";
import { list } from "@r3825-made-up/store";
export const start = () => connect() + " " + list();

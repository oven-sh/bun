import { connect } from "./connect.mjs";
import { list } from "./store.mjs";
export const start = () => connect() + " " + list();

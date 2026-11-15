import { connect } from "./connect.mjs";
import { region } from "./store.mjs";

export const start = () => connect() + " " + region;

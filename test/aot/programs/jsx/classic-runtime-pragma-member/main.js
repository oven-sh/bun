// Classic JSX runtime: the pragmas name members of an imported object (`R.createElement`, `R.Fragment`).
/** @jsxRuntime classic */
/** @jsx R.createElement */ /** @jsxFrag R.Fragment */
import R from "./r.cjs";
console.log(<a />, <></>);

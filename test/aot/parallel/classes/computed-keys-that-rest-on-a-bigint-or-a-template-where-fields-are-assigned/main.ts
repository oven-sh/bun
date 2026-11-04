// Keys in brackets that rest on a bigint or on a template, where the tsconfig.json beside the classes says that fields are assigned: `bun build` assigns them unless a field stands under a key that it has to compute.
// It computes with a bigint that is written in decimal digits and with a template that is ASCII. Of a bigint that is written with a radix it knows the kind alone, and a template beyond ASCII it leaves.
// Reference: bun build --compile
import "./keys/classes.ts";

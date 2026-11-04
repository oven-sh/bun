import { feature } from "bun:bundle"
export const IS_INTERNAL = process.env.APP_CHANNEL === "internal"
export const HAS_FEATURE = feature("ON") ? true : false
export function isInternal() {
  return process.env.APP_CHANNEL === "internal"
}
export const hasFeature = () => (feature("ON") ? true : false)
export function decidesInSteps() {
  if (feature("OFF")) return "off"
  if (IS_INTERNAL) {
    return "internal"
  }
  return ""
}
export enum Level {
  Quiet,
  Loud,
  Louder = Loud * 2,
}
export const enum Channel {
  Public = "public",
  Internal = "internal",
}
export const LEVEL = Level.Quiet
export let calls = 0
export function countsCalls() {
  calls++
  return false
}
export function dependsOnItsArgument(flag: boolean) {
  return flag
}
export let reassigned = false
export function reassign() {
  reassigned = true
}

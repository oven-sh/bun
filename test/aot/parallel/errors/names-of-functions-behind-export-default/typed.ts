export default function (): string {
  return new Error("here")
    .stack!.split("\n")[1]
    .trim()
    .replace(/\(.*[\/\\]/, "(");
}

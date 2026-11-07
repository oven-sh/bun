export const dynamic = "force-dynamic";

export default function Page(): never {
  throw new RangeError("thrown while rendering");
}

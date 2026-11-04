interface Inner2 { extra: number; quiet?: () => unknown }
interface Box2 { extra: number; name: string; inner: Inner2; failed?: { extra: number; message: string; name: string } }
export const box2: Box2 = { extra: 2, name: 'b2', inner: { extra: 2 } };
export function make2(extra: number): Box2 { return { extra, name: 'm', inner: { extra } }; }

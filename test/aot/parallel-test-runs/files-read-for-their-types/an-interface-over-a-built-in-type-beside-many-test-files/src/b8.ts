interface Inner8 { extra: number; quiet?: () => unknown }
interface Box8 { extra: number; name: string; inner: Inner8; failed?: { extra: number; message: string; name: string } }
export const box8: Box8 = { extra: 8, name: 'b8', inner: { extra: 8 } };
export function make8(extra: number): Box8 { return { extra, name: 'm', inner: { extra } }; }

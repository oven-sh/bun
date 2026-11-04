interface Inner3 { extra: number; quiet?: () => unknown }
interface Box3 { extra: number; name: string; inner: Inner3; failed?: { extra: number; message: string; name: string } }
export const box3: Box3 = { extra: 3, name: 'b3', inner: { extra: 3 } };
export function make3(extra: number): Box3 { return { extra, name: 'm', inner: { extra } }; }

interface Inner10 { extra: number; quiet?: () => unknown }
interface Box10 { extra: number; name: string; inner: Inner10; failed?: { extra: number; message: string; name: string } }
export const box10: Box10 = { extra: 10, name: 'b10', inner: { extra: 10 } };
export function make10(extra: number): Box10 { return { extra, name: 'm', inner: { extra } }; }

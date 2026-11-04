interface Inner4 { extra: number; quiet?: () => unknown }
interface Box4 { extra: number; name: string; inner: Inner4; failed?: { extra: number; message: string; name: string } }
export const box4: Box4 = { extra: 4, name: 'b4', inner: { extra: 4 } };
export function make4(extra: number): Box4 { return { extra, name: 'm', inner: { extra } }; }

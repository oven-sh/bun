interface Inner20 { extra: number; quiet?: () => unknown }
interface Box20 { extra: number; name: string; inner: Inner20; failed?: { extra: number; message: string; name: string } }
export const box20: Box20 = { extra: 20, name: 'b20', inner: { extra: 20 } };
export function make20(extra: number): Box20 { return { extra, name: 'm', inner: { extra } }; }

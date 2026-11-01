let x = 1; export { x as default }; export const setX = v => { x = v; }; let y = 1; export const getY = () => y; export const setY = v => { y = v; };

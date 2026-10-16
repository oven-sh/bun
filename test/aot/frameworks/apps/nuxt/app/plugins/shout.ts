export default defineNuxtPlugin(() => ({ provide: { shout: (text: string) => text.toUpperCase() + "!" } }));

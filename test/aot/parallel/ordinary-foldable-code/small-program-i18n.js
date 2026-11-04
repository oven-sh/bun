const LOCALE = "de";
const MESSAGES = {
  en: { hello: "Hello", bye: "Goodbye" },
  de: { hello: "Hallo", bye: "Tschüss" },
};
const t = (key) => MESSAGES[LOCALE]?.[key] ?? MESSAGES.en[key] ?? key;
console.log(t("hello"), t("bye"), t("missing"));

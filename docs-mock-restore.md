# Guia: Restaurando Módulos Mockados no Bun

## 🎯 Problema

Antes desta implementação:
```typescript
import { test, mock } from "bun:test";

test("teste 1", async () => {
  mock.module("./age", () => ({ getAge: () => 25 }));
  const { getAge } = await import("./age");
  console.log(getAge()); // 25 ✓
});

test("teste 2", async () => {
  // ❌ PROBLEMA: Mock do teste 1 ainda ativo!
  const { getAge } = await import("./age");
  console.log(getAge()); // 25 (deveria ser 36)
});
```

## ✅ Solução

### Opção 1: Limpar após cada teste

```typescript
import { test, mock, afterEach } from "bun:test";

afterEach(() => {
  mock.restore(); // Limpa TUDO (funções + módulos)
});

test("teste 1", async () => {
  mock.module("./age", () => ({ getAge: () => 25 }));
  const { getAge } = await import("./age");
  expect(getAge()).toBe(25); // ✓
});

test("teste 2", async () => {
  // ✓ Mock foi limpo no afterEach
  delete require.cache[require.resolve("./age")];
  const { getAge } = await import("./age" + "?v=1");
  expect(getAge()).toBe(36); // ✓ Original restaurado!
});
```

### Opção 2: Restaurar módulo específico

```typescript
import { test, mock } from "bun:test";

test("restaurar módulo específico", async () => {
  // Mock módulo A
  mock.module("./moduleA", () => ({ value: "A-mocked" }));

  // Mock módulo B
  mock.module("./moduleB", () => ({ value: "B-mocked" }));

  // Restaurar APENAS módulo A
  mock.restoreModule("./moduleA");

  // A foi restaurado, B ainda mockado
  delete require.cache[require.resolve("./moduleA")];
  const a = await import("./moduleA" + "?v=1");
  expect(a.value).toBe("A-original"); // ✓

  const b = await import("./moduleB");
  expect(b.value).toBe("B-mocked"); // ✓
});
```

### Opção 3: Restaurar todos os módulos

```typescript
import { test, mock } from "bun:test";

test("restaurar todos os módulos", async () => {
  mock.module("./moduleA", () => ({ value: "mocked" }));
  mock.module("./moduleB", () => ({ value: "mocked" }));
  mock.module("./moduleC", () => ({ value: "mocked" }));

  // Restaurar TODOS os módulos de uma vez
  mock.restoreModule();

  // Todos foram restaurados
  // (Lembre-se de limpar o cache e re-importar)
});
```

## 📚 API Completa

### `mock.restore()`

Restaura **tudo**: funções mockadas E módulos mockados.

```typescript
const mockFn = mock(() => "fn");
mock.module("./mod", () => ({ value: "mocked" }));

mock.restore(); // Limpa AMBOS
```

### `mock.restoreModule()`

Restaura **apenas módulos** (não afeta funções mockadas).

```typescript
const mockFn = mock(() => "fn"); // Não será afetado
mock.module("./mod", () => ({ value: "mocked" }));

mock.restoreModule(); // Limpa APENAS o módulo
```

### `mock.restoreModule(path)`

Restaura **um módulo específico**.

```typescript
mock.module("./modA", () => ({ value: "A" }));
mock.module("./modB", () => ({ value: "B" }));

mock.restoreModule("./modA"); // Limpa APENAS modA
```

## ⚠️ Importante: Cache de Módulos

Após restaurar um módulo, você precisa:

1. **Limpar o cache** do require/import
2. **Re-importar** o módulo (com query string diferente)

```typescript
// ❌ ERRADO
mock.restoreModule("./age");
const { getAge } = await import("./age"); // Ainda retorna versão em cache

// ✅ CORRETO
mock.restoreModule("./age");
delete require.cache[require.resolve("./age")]; // Limpar cache
const { getAge } = await import("./age" + "?v=1"); // Re-importar
```

## 🎨 Padrões Recomendados

### Padrão 1: afterEach Global

```typescript
import { afterEach, mock } from "bun:test";

// No topo do arquivo de teste
afterEach(() => {
  mock.restore();
});

// Todos os testes ficam isolados automaticamente
```

### Padrão 2: Preload para Todos os Testes

**`test-setup.ts`:**
```typescript
import { afterEach, mock } from "bun:test";

afterEach(() => {
  mock.restore();
});
```

**`bunfig.toml`:**
```toml
[test]
preload = ["./test-setup.ts"]
```

### Padrão 3: Helper de Teste

```typescript
import { mock } from "bun:test";

export async function mockAndTest<T>(
  modulePath: string,
  mockValue: any,
  testFn: (module: T) => Promise<void>
) {
  mock.module(modulePath, () => mockValue);

  try {
    const module = await import(modulePath);
    await testFn(module as T);
  } finally {
    mock.restoreModule(modulePath);
  }
}

// Uso
await mockAndTest("./age", { getAge: () => 25 }, async (age) => {
  expect(age.getAge()).toBe(25);
});
// Mock automaticamente restaurado!
```

## 🐛 Troubleshooting

### Mock não está sendo limpo

```typescript
// Certifique-se de limpar o cache:
delete require.cache[require.resolve("./module")];

// E re-importar com query string diferente:
const mod = await import("./module" + "?v=" + Date.now());
```

### Mock de um módulo afeta outros testes

```typescript
// Use afterEach para limpar após cada teste:
afterEach(() => {
  mock.restore();
});
```

### Quero restaurar só alguns módulos

```typescript
// Use mock.restoreModule() com path específico:
mock.restoreModule("./moduleA");
mock.restoreModule("./moduleB");
// moduleC continua mockado
```

## 📝 Exemplos Completos

### Exemplo 1: Teste de API com Mock de Cliente HTTP

```typescript
import { test, expect, mock, afterEach } from "bun:test";

afterEach(() => {
  mock.restore();
});

test("fetchUser retorna dados mockados", async () => {
  // Mock o cliente HTTP
  mock.module("./http-client", () => ({
    get: async () => ({ id: 1, name: "Test User" })
  }));

  const { fetchUser } = await import("./api");
  const user = await fetchUser(1);

  expect(user.name).toBe("Test User");
  // Mock será limpo pelo afterEach
});

test("fetchUser usa cliente real", async () => {
  // Sem mock, usa implementação real
  const { fetchUser } = await import("./api");
  const user = await fetchUser(1);

  expect(user).toBeDefined();
  // Dados reais da API
});
```

### Exemplo 2: Teste de Configuração

```typescript
import { test, expect, mock } from "bun:test";

test("usa configuração mockada", async () => {
  mock.module("./config", () => ({
    API_URL: "http://localhost:3000",
    DEBUG: true
  }));

  const { app } = await import("./app");
  expect(app.apiUrl).toBe("http://localhost:3000");

  // Restaurar para próximo teste
  mock.restoreModule("./config");
});

test("usa configuração real", async () => {
  delete require.cache[require.resolve("./config")];
  delete require.cache[require.resolve("./app")];

  const { app } = await import("./app" + "?v=2");
  expect(app.apiUrl).toBe("https://api.production.com");
});
```

## 🎯 Compatibilidade

- ✅ ESM (import/export)
- ✅ CJS (require/module.exports)
- ✅ Caminhos relativos
- ✅ Caminhos absolutos
- ✅ Pacotes npm
- ✅ URLs file://

## 🚀 Próximos Passos

Esta implementação resolve as issues:
- #7823 - mock.restore não funcionava para módulos
- #12823 - Mocks vazavam entre arquivos de teste
- #5391 - Impossível resetar mocks

Aproveite o isolamento de testes! 🎉

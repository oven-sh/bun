# Bun-Elixir : Architecture et Standards

Ce document définit les mandates fondamentaux et les conventions architecturales pour le projet **Bun-Elixir**, une reconstruction haute performance de l'écosystème Node.js/Bun utilisant Elixir pour l'orchestration et Rust pour le moteur d'exécution.

## Architecture du Projet

Le projet repose sur un modèle hybride où Elixir gère l'asynchronisme et Rust l'exécution synchrone haute performance.

### 1. Le Monde Elixir (`lib/`)
- **Responsabilité** : Orchestration, réseau (via `Req`), gestion des processus OS (`Port`), et persistance du runtime.
- **Composants Clés** :
  - `BunNext.Runtime` : Un GenServer gérant le cycle de vie d'une instance JS. Il fait le pont entre les messages asynchrones du JS et les capacités de la BEAM.
  - `BunNext.CLI` / `Mix.Tasks.Bun.Run` : Interface de pilotage du runtime.
  - **Réseau & Processus** : Elixir exécute les requêtes `fetch` et gère le streaming des processus fils.

### 2. Le Monde Rust (`native/native/src/lib.rs`)
- **Responsabilité** : Parsing (oxc), Syscalls FS réels, Cryptographie (ring), et exécution du code (Boa).
- **Runtime Persistant** : Chaque instance JS vit dans un thread OS dédié en Rust pour garantir la sécurité mémoire (Boa n'est pas thread-safe).
- **Composants Clés** :
  - `ResourceArc<Runtime>` : Référence Elixir vers le runtime Rust persistant.
  - `N-API Loader` : Chargement dynamique de bibliothèques natives (.dll).

## Standards d'Ingénierie

### Communication Elixir-Rust
- **Zero-Copy** : Utilisation de `push_binary` pour transférer des données Elixir directement en `Uint8Array` JavaScript sans copies inutiles.
- **Async Bridge** : `sendToElixir(data)` via `OwnedEnv` pour notifier Elixir d'événements JavaScript de manière non-bloquante.

## État de l'Implémentation

### Phases Complétées
- [x] **Phase 1-10** : Fondations, Parsing, TS, et Résolution Semver.
- [x] **Phase 11-12** : Syscalls FS réels (écriture/lecture/mkdir) en Rust.
- [x] **Phase 14** : Support de `fetch` (GET/POST/Zero-Copy) via Elixir.
- [x] **Phase 15-16** : Support de `child_process` avec **Streaming Réel** via les Ports Elixir.
- [x] **Phase 17** : Interface CLI complète via `mix bun.run` et `mix bun.test`.
- [x] **Phase 18** : Optimisation Zero-Copy pour les transferts de données.
- [x] **Phase 19** : Support des addons natifs (**N-API**) avec chargement dynamique de DLL.
- [x] **Phase 20** : Infrastructure de certification et modules de compatibilité (`os`, `path`, `fs`, `crypto`, `buffer`, `util`, `events`, `assert`, `test`, `http`).
- [x] **Phase 22** : Support des **Worker Threads** (Parallélisme via processus Elixir).
- [x] **Phase 23** : **Fidélité N-API** : Implémentation initiale de l'interface C standard.
- [x] **Phase 24** : **Optimisation AOT/JIT** : Intégration de la minification AST (Oxc) pour accélérer la compilation Bytecode du moteur Boa.

### En cours / À faire
- [ ] **Phase 25 : Support des Streams Node.js** : Implémentation complète de `node:stream`.

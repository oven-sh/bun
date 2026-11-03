#!/usr/bin/env python3
"""measure.py <folder of executables> <golden folder> <rows.tsv to append to> <tests,> <columns,>

Measures the backend benchmark on Linux. Postgres and the carrier service must be running already (see README.md).

A COLUMN is an executable in the folder, started with PORT, DATABASE_URL, DATABASE_POOL and CARRIER_URL set ($<COLUMN>_RUN_ENV="NAME=value,NAME=value ..":
more environment for that column alone, such as a pool size of its own; $<COLUMN>_LAUNCHER="setarch,x86_64,-R": words put in front
of the executable). A column whose name
is listed in $SINGLE_THREADED (aot, jit, released by default) runs JavaScript on one thread, so it is started once per server
core, each process pinned to a core of its own, all listening on one port with SO_REUSEPORT. Every other column (go, rust) is one
process that may use all the server's cores.

A TEST is one of: plaintext json db queries1 queries5 queries10 queries15 queries20 fortunes updates1 updates5 updates10 updates15
updates20 quote product. Or the name of a file <golden folder>/<test>.json: a list of requests with their answers ({method, path,
headers, body, status, kind, check, answer}; tracker/exchanges.ts writes such files), which the client sends in turn.

For each test, $LOADED_STARTS (3) times over, with the order of the columns turned by one each time:
 1. Every column is started $STARTS (5) times. The time from exec to the first complete right answer is kept. The last start stays,
    and its memory is read. It is warmed with windows of requests until user instructions per request of the last three windows
    lie within $WITHIN (2) percent, at least $WARM (100,000) requests (a test of n queries: the n-th part, but 10,000), at most
    $LONGEST (40) seconds. FRESH OR SETTLED: that warm-up takes some ten seconds, and a JIT may still have a tier to go. With
    $WARM_SECONDS (0; $<COLUMN>_WARM_SECONDS for one column) the load goes on behind it, with the hardware counters off, until that
    many seconds have passed. rate_curve keeps seconds:requests per second for every window, so that one can see where the rate
    stopped rising. With $SPARE_CORES (a list of cores; only where the server has one core) the columns take that long load side by
    side, each on a spare core, and are moved back to the server's core before they are read: a card takes half the time.
    Then the column is stopped (SIGSTOP), once none of its threads has run for 100 ms. early_requests_a_second is the rate over the first 10,000 requests of the
    process (the first two windows, counters off): what a deployment that starts a process per burst of traffic sees.
    UNDER CONTINUOUS LOAD ($CONTINUOUS=yes): a column that is stopped between its windows idles, and a JIT pays for that when it goes
    on (its next window can cost several percent more instructions). So here nothing is ever stopped. A column is a fresh process
    that is loaded for $WARM_SECONDS without a pause. Its rate is the middle of ALL its windows from $READ_FROM (20) seconds on.
    The window with the hardware counters and the paced one follow at once, and then it is ended. Steps 2 to 4 fall away. With
    $SPARE_CORES the columns of one kind (one process per core | one process for all cores) live side by side, each on a core of
    its own for its whole life, so that they are read in the same weather. The cores go round from start to start. Without it the
    columns come one after another. $TOGETHER (a+b+c/d+e+f) says who lives beside whom instead: compare only within a group, and keep
    the groups equally wide: a column has less of the shared cache, of the client and of Postgres the more neighbours it has. Busy shares of the client, of Postgres and of the other service are then of all columns together.
 2. $ROUNDS (5) rounds: each column in turn is continued, serves one window of about $WINDOW_SECONDS (1.5), and is stopped. So the
    columns are read seconds apart. A round more than 10% under the column's best is left out. Rounds are added, up to
    $ROUNDS_MOST (10), until every column has three within 3% of its best. A number is the middle of the rounds that stand.
 3. $COUNTER_ROUNDS (2) rounds more, in turn as before, with the hardware counters on: user instructions and cycles per request.
    THE ROUNDS OF STEP 2 RUN WITHOUT THEM: `perf stat -e instructions:u,cycles:u` on a server whose threads hand work to each other
    (Bun's fetch has a thread of its own) has to save and restore the counters at every switch, and on a virtual machine that halved
    the requests per second of the quote. counted_requests_a_second is the rate with the counters on, to show what they cost.
 4. $PACED_ROUNDS (3) rounds of an open loop at a fixed rate that every column can bear ($PACED_RATE, or a tenth part per test
    below): latency from the moment a request was due. The best round counts.
The row of a column is the middle of its starts. start_* fields keep every start.

The client (load.c) keeps $CONNECTIONS (256) connections open, each with one request outstanding (plaintext: 16, pipelined), and
checks every response: status, media type and body. CPU time is `perf stat -e task-clock` on all processes of the column.
Memory: RSS and private memory (Anonymous less LazyFree) are summed over the column's processes. settled_*: $SETTLE (0) seconds after the
last request.
BY LAYER ($LAYERS=yes, under continuous load only): two more windows follow the counted one, under `perf record -e cycles:u` and
`-e instructions:u`. Every sample is charged to the layer that owns the code it fell in (../../servers/measure/layers.py: the
compiled application, stubs, Bun's own JavaScript modules, Bun's native code, the engine's C++, ICU, GC, malloc, libc), scaled to
the counted cycles and instructions per request. Kernel cycles are user cycles times kernel CPU time over user CPU time, both read
in the windows without hardware counters. The row
gets layers_cycles and layers_instructions (layer:count ..), and an --aot column layers_asked (who/layer:cycles ..) from a third
window with call chains: who asked for the work, the application's compiled code, Bun's own modules, or nobody; layers_sampled is
samples times period over the counted total (well under 1: the kernel dropped samples, and threads that mostly sleep look too large); the heaviest symbols of every layer go to <rows.tsv>.symbols, and the
single stubs too where <executable>.map exists (`BUN_JSC_aotMapFilePath=<executable>.map bun build --compile --aot ..`). The
executables must not be stripped. table.py prints the layers side by side.
EVENTS="ic_cache_fill_l2,l2_cache_req_stat.ic_fill_miss": more hardware events by perf's names, counted with instructions and cycles, per
request, as fields of their own. On AMD Zen 4 these two are the lines of code that the first-level cache took from the L2 and the
lines that came from beyond the L2: neither is part of the other, and the lines fetched are their sum. At most four, or perf takes turns (counted=MULTIPLEXED).
COPIES: the pages of an executable file stay where they are in the page cache for as long as the file lives, so all processes of one
file share one placement of its code in physical memory, and two files with the same bytes can differ by some percent in cycles.
Every start therefore runs a copy of the executable that was made for it, in /dev/shm, under a path of the same length for every column.
cp makes the copy: were it written by this process, a child that another column's thread forks meanwhile would hold it open for writing, and
the kernel refuses to execute such a file ("Text file busy").
GUESTS: every window compares the time the kernel charged to the column's cores (user, nice and system in /proc/stat) with the time
it charged to the column's processes. What is left over ran for somebody else. A window in which that is more than 1% of those cores is
left out of the rate; guests is the largest share in a window that was kept, windows_void how many were left out, and a start
without a clean window has void=yes: table.py and pairs.py print no number for it.
postgres_busy, carrier_busy, client_busy: the share of their cores that Postgres, the carrier and the client used during the
rounds. Where one of them is above 0.9 the server was not the limit and the row says limit=<which>."""
import fcntl, hashlib, html, json, os, re, resource, signal, socket, statistics, subprocess, sys, threading, time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'servers', 'measure'))
import layers

folder, golden, rows_file, tests, columns = sys.argv[1:6]
E = os.environ.get
SERVER_CORES, CLIENT_CORES = E('SERVER_CORES', '0'), E('CLIENT_CORES', '1-3')
POSTGRES_CORES, CARRIER_CORES = E('POSTGRES_CORES', ''), E('CARRIER_CORES', '')
POSTMASTER, CARRIER_PIDS = int(E('POSTMASTER_PID', '0')), [int(x) for x in E('CARRIER_PIDS', '').split()]
WARM, LONGEST, WITHIN, ROUNDS, STARTS = int(E('WARM', '100000')), float(E('LONGEST', '40')), float(E('WITHIN', '2')), int(E('ROUNDS', '5')), int(E('STARTS', '5'))
ROUNDS_MOST, LOADED_STARTS, WINDOW_SECONDS = max(ROUNDS, int(E('ROUNDS_MOST', '10'))), int(E('LOADED_STARTS', '3')), float(E('WINDOW_SECONDS', '1.5'))
PACED_ROUNDS, PACED_LEAD, PACED_SECONDS, COUNTER_ROUNDS = int(E('PACED_ROUNDS', '3')), 0.5, 2.0, int(E('COUNTER_ROUNDS', '2'))
CONNECTIONS, POOL, LOAD, TMP = int(E('CONNECTIONS', '256')), E('DATABASE_POOL', '8'), os.path.join(folder, 'load'), E('TMP_DIR', '/tmp')
SINGLE_THREADED = E('SINGLE_THREADED', 'aot jit released node').split()
SETTLE = float(E('SETTLE', '0'))
LAYERS = E('LAYERS', '') == 'yes'
SAMPLES_A_SECOND = 3000  # the kernel drops samples silently above kernel.perf_event_max_sample_rate, which it lowers by itself under load (seen: 5,300)
LABEL = E('LABEL', '-')


def cores_of(text):
    cores = []
    for part in text.split(','):
        if part:
            a, _, b = part.partition('-')
            cores += range(int(a), int(b or a) + 1)
    return cores


SERVER, CLIENT = cores_of(SERVER_CORES), cores_of(CLIENT_CORES)
SPARE = E('SPARE_CORES', '').split(',') if E('SPARE_CORES', '') and len(SERVER) == 1 else []
CONTINUOUS, READ_FROM, one_at_a_time = E('CONTINUOUS', '') == 'yes', float(E('READ_FROM', '20')), threading.Lock()
JSON, TEXT, HTML = 'application/json', 'text/plain', 'text/html'
TESTS = {'plaintext': ('/plaintext', TEXT, 'exact', 16, 20000), 'json': ('/json', JSON, 'exact', 1, 20000), 'db': ('/db', JSON, 'worlds 0', 1, 5000), 'fortunes': ('/fortunes', HTML, 'exact', 1, 5000),
         'quote': ('/api/shops/west/quotes', JSON, 'exact', 1, 1000), 'product': ('/api/shops/west/products/2', JSON, 'exact', 1, 5000)}
for n in (1, 5, 10, 15, 20):
    TESTS['queries%d' % n] = ('/queries?queries=%d' % n, JSON, 'worlds %d' % n, 1, max(500, 5000 // n))
    TESTS['updates%d' % n] = ('/updates?queries=%d' % n, JSON, 'worlds %d' % n, 1, max(250, 2500 // n))
for name in tests.split(','):
    if name not in TESTS and os.path.exists(os.path.join(golden, name + '.json')):
        TESTS[name] = (None, None, 'exact', 1, 500)
FORTUNES = None


def lines_of(method, path, port, headers, body):
    head = '%s %s HTTP/1.1\r\nHost: 127.0.0.1:%d\r\n' % (method or ('GET' if body is None else 'POST'), path, port) + ''.join(h + '\r\n' for h in headers)
    if body is not None:
        head += ('' if any(h.lower().startswith('content-type:') for h in headers) else 'Content-Type: application/json\r\n') + 'Content-Length: %d\r\n' % len(body)
    return head


def ask(port, path, headers=(), body=None, method=None):
    c = socket.create_connection(('127.0.0.1', port), timeout=10)
    head = lines_of(method, path, port, tuple(headers) + ('Connection: close',), body)
    c.sendall(head.encode() + b'\r\n' + (body or b''))
    d = b''
    while True:
        x = c.recv(65536)
        if not x:
            break
        d += x
    c.close()
    h, b = d.split(b'\r\n\r\n', 1)
    lines = h.decode('latin-1').split('\r\n')
    f = dict((l.split(':', 1)[0].lower(), l.split(':', 1)[1].strip()) for l in lines[1:])
    if f.get('transfer-encoding', '').lower() == 'chunked':
        whole = b''
        while b:
            size, b = b.split(b'\r\n', 1)
            n = int(size.split(b';')[0], 16)
            if n == 0:
                break
            whole += b[:n]
            b = b[n + 2:]
        b = whole
    return int(lines[0].split()[1]), f, b


def rollup(pid):
    try:
        t = open('/proc/%d/smaps_rollup' % pid).read()
    except OSError:
        return {}
    r = dict((k, int(v) / 1024) for k, v in re.findall(r'^(\w+):\s+(\d+) kB', t, re.M))
    r['Private'] = r.get('Anonymous', 0.0) - r.get('LazyFree', 0.0)
    return r


def status(pid, name):
    try:
        return int(re.search(r'^%s:\s+(\d+)' % name, open('/proc/%d/status' % pid).read(), re.M).group(1))
    except Exception:
        return 0


def cpu_seconds(pids, fields=(11, 12)):
    total = 0.0
    for pid in pids:
        try:
            f = open('/proc/%d/stat' % pid).read().rsplit(')', 1)[1].split()
            total += sum(int(f[k]) for k in fields) / 100
        except OSError:
            pass
    return total


def core_seconds(cores):
    wanted = set('cpu%d' % c for c in cores)
    return sum(sum(int(x) for x in l.split()[1:4]) for l in open('/proc/stat') if l.split(' ', 1)[0] in wanted) / 100


def children(parent):
    try:
        return [int(x) for t in os.listdir('/proc/%d/task' % parent) for x in open('/proc/%d/task/%s/children' % (parent, t)).read().split()]
    except OSError:
        return []


def write(line):
    with open(rows_file, 'a') as out:
        fcntl.flock(out, fcntl.LOCK_EX)
        out.write(line + '\n')


class Broke(Exception):
    pass


bad = []
spawned = [0]
numbers = {}
EVENTS = [e for e in E('EVENTS', '').split(',') if e]


class Server:
    def __init__(self, test, column, home=None):
        self.test, self.column, self.binary, self.home, self.loaded = test, column, os.path.join(folder, column), home, []
        self.path, self.kind, self.check, self.pipeline, self.pace = TESTS[test]
        self.pace = int(E('PACED_RATE', self.pace * (len(SERVER) if len(SERVER) < 4 else 4)))
        self.processes, self.windows, self.rounds, self.counted, self.paced, self.total, self.high, self.layers, self.sampled = [], [], [], [], [], 0, 0.0, {}, []
        self.name = '%s/%s/%d' % (test, column, len(SERVER))
        self.least = max(10000, WARM // int(re.sub(r'\D', '', test) or 1))
        self.folder = os.path.join(TMP, 'backend-%d' % SERVER[0], column)
        with one_at_a_time:
            number = numbers.setdefault(column, len(numbers))
        self.copy = os.path.join('/dev/shm' if os.access('/dev/shm', os.W_OK) else TMP, 'aot-backend-core-%03d-column-%02d' % (SERVER[0], number))
        os.makedirs(self.folder, exist_ok=True)
        self.exchanges, self.listed = [((), None, None)], None
        if self.path is None:
            self.listed = json.load(open(os.path.join(golden, test + '.json'), encoding='utf-8'))
            self.exchanges = [(tuple(x['headers']), None if x['body'] is None else x['body'].encode(), x['answer'].encode()) for x in self.listed]
        elif test == 'quote':
            self.exchanges = []
            for k in range(100):
                f = os.path.join(golden, 'quote.%d' % k)
                if not os.path.exists(f + '.request'):
                    break
                token, request = open(f + '.request', 'rb').read().split(b'\n', 1)
                self.exchanges.append((('Authorization: Bearer ' + token.decode(),), request, open(f + '.answer', 'rb').read()))
        elif os.path.exists(os.path.join(golden, test + '.answer')):
            self.exchanges = [((), None, open(os.path.join(golden, test + '.answer'), 'rb').read())]

    def pids(self):
        return [p.pid for p in self.processes]

    def tail(self):
        return open(os.path.join(self.folder, 'server.log'), 'rb').read()[-300:].decode('latin-1').replace('\n', ' ~ ')

    def end(self):
        for p in self.processes:
            if p.poll() is None:
                p.kill()
            p.wait()
        self.processes = []
        if os.path.exists(self.copy):
            os.remove(self.copy)

    def signal(self, what):
        for p in self.processes:
            p.send_signal(what)

    def run_time_ns(self):
        total = 0
        try:
            for pid in self.pids():
                for thread in os.listdir('/proc/%d/task' % pid):
                    total += int(open('/proc/%d/task/%s/schedstat' % (pid, thread)).read().split()[0])
        except (OSError, ValueError, IndexError):
            pass
        return total

    def stop(self):
        """Stops the column once none of its threads has run for 100 ms: behind the collections that a Bun server runs when the load
        ends. A stop right behind the load fell before them, into them or behind them, and peak RSS went by which."""
        deadline, quiet_polls, before = time.perf_counter() + 3, 0, self.run_time_ns()
        while quiet_polls < 10 and time.perf_counter() < deadline:
            time.sleep(0.01)
            now = self.run_time_ns()
            quiet_polls, before = (quiet_polls + 1 if now - before < 50000 else 0), now
        self.signal(signal.SIGSTOP)

    def go_on(self):
        self.signal(signal.SIGCONT)

    def dead(self):
        return [p.returncode for p in self.processes if p.poll() is not None]

    def right(self, code, fields, body, want, k=0):
        if self.listed:
            x = self.listed[k]
            same = len(body) == len(want) if x['check'] == 'length' else body == want
            return code == x['status'] and 'date' in fields and same and x['kind'] in ('-', fields.get('content-type', '').split(';')[0].strip().lower())
        if code != 200 or fields.get('content-type', '').split(';')[0].strip().lower() != self.kind:
            return False
        if 'date' not in fields or (self.test not in ('quote', 'product') and 'server' not in fields):
            return False
        if self.check.startswith('worlds'):
            n = int(self.check.split()[1])
            rows = json.loads(body)
            rows = [rows] if n == 0 else rows
            return len(rows) == max(n, 1) and all(set(r) == {'id', 'randomNumber'} and 1 <= r['id'] <= 10000 and 1 <= r['randomNumber'] <= 10000 for r in rows)
        if self.test == 'fortunes':  # the escapes may be spelled differently from one language to the next: compare what a browser would show
            return html.unescape(body.decode()) == html.unescape(want.decode())
        return want is None or body == want

    def start(self):
        env = dict((k, v) for k, v in os.environ.items() if k != 'GOMAXPROCS')
        env.update(NODE_ENV='production', BUN_ENABLE_CRASH_REPORTING='0', DO_NOT_TRACK='1', DATABASE_POOL=POOL)
        single = self.column.split('.')[0] in SINGLE_THREADED
        if single:
            env['WTF_numberOfProcessorCores'] = '1'
        if self.column.split('.')[0] == 'aot':
            env['BUN_JSC_crashIfInterpreterIsUsed'] = '1'
            if LAYERS:
                env['BUN_JSC_useAOTPerfMap'] = '1'
        env.update(x.split('=', 1) for x in E(self.column.upper().replace('.', '_') + '_RUN_ENV', '').replace(',', ' ').split())
        launcher = E(self.column.upper().replace('.', '_') + '_LAUNCHER', '').replace(',', ' ').split()
        self.pool = env['DATABASE_POOL']
        pins = [self.home] if self.home else [str(c) for c in SERVER] if single else [SERVER_CORES]
        firsts = []
        headers, request, want = self.exchanges[0]
        for _ in range(STARTS):
            self.end()
            with one_at_a_time:
                spawned[0] += 1
                self.port = 21400 + (SERVER[0] * 7 + spawned[0]) % 400
            env['PORT'] = str(self.port)
            log = open(os.path.join(self.folder, 'server.log'), 'wb')
            first = None
            subprocess.run(['cp', self.binary, self.copy], check=True)
            t0 = time.perf_counter()
            self.processes = [subprocess.Popen(['taskset', '-c', pin] + launcher + [self.copy], env=env, stdout=log, stderr=log, stdin=subprocess.DEVNULL, cwd=self.folder) for pin in pins]
            while time.perf_counter() - t0 < 30 and not self.dead():
                try:
                    code, fields, self.body = ask(self.port, self.listed[0]['path'] if self.listed else self.path, headers, request, self.listed and self.listed[0]['method'])
                    first = time.perf_counter() - t0
                    break
                except (OSError, ValueError, IndexError):
                    time.sleep(0.0005)
            if first is None:
                raise Broke('no answer', self.tail())
            firsts.append(first)
        self.firsts = firsts
        if not self.right(code, fields, self.body, want):
            raise Broke('another answer', '%d %s %r | %s' % (code, fields.get('content-type'), self.body[:120], self.tail()))
        t0 = time.perf_counter()
        while open(os.path.join(self.folder, 'server.log'), 'rb').read().count(b'listening') < len(pins):
            if time.perf_counter() - t0 > 30 or self.dead():
                raise Broke('not all processes listen', self.tail())
            time.sleep(0.002)
        self.head = fields
        self.ready_rss = sum(status(p, 'VmRSS') for p in self.pids()) / 1024
        self.ready_private = sum(rollup(p).get('Private', 0.0) for p in self.pids())
        self.pairs = []
        for k, (headers, request, want) in enumerate(self.exchanges):
            x = self.listed[k] if self.listed else {'method': None, 'path': self.path, 'status': 200, 'kind': self.kind, 'check': self.check}
            if k:
                code, fields, body = ask(self.port, x['path'], headers, request, x['method'])
                if not self.right(code, fields, body, want, k):
                    raise Broke('another answer', 'exchange %d: %d %r' % (k, code, body[:120]))
            else:
                body = self.body
            raw = lines_of(x['method'], x['path'], self.port, headers, request) + '\r\n'
            self.pairs += [os.path.join(self.folder, 'request-%d' % k), os.path.join(self.folder, 'expected-%d' % k)]
            open(self.pairs[-2], 'wb').write(raw.encode() + (request or b''))
            open(self.pairs[-1], 'wb').write(('%d\n%s\n%s\n' % (x['status'], x['kind'], x['check'])).encode() + body)

    def window(self, size, rate=None, lead=0, counters=True):
        size -= size % self.pipeline
        pids = self.pids()
        f = os.path.join(self.folder, 'stat.csv')
        done = threading.Event()
        here = [0.0]

        def watch():
            while not done.wait(0.05):
                here[0] = max(here[0], sum(rollup(p).get('Private', 0.0) for p in pids))
        env = dict(os.environ)
        if rate:
            env.update(LOAD_RATE=str(rate), LOAD_SKIP=str(lead))
        elif self.pipeline > 1:
            env['LOAD_PIPELINE'] = str(self.pipeline)
        client = ['taskset', '-c', CLIENT_CORES, LOAD, str(self.port), str(CONNECTIONS), str(size + lead), str(len(CLIENT))] + self.pairs
        if rate:  # nothing of the instrument touches the server while its tail is read
            o = subprocess.run(client, capture_output=True, text=True, env=env)
            j = dict(zip(o.stdout.split()[0::2], o.stdout.split()[1::2]))
            if self.dead() or o.returncode != 0 or 'p99_us' not in j:
                raise Broke('broke under load', 'exit %s | the client: %s | %s' % (self.dead(), (o.stderr or o.stdout)[-200:].replace('\r', '').replace('\n', ' '), self.tail()))
            self.total += size + lead
            return {'p50': float(j['p50_us']), 'p99': float(j['p99_us']), 'p999': float(j['p999_us']), 'longest': float(j['longest_us'])}
        w = threading.Thread(target=watch, daemon=True)
        w.start()
        events = ('instructions:u', 'cycles:u', 'task-clock') + tuple(e + ':u' for e in EVENTS) if counters else ('task-clock',)
        try:
            for attempt in range(4):  # a thread that ends while perf attaches fails the call before the client is started
                backends = children(POSTMASTER) if POSTMASTER else []
                mine = [int(self.home)] if self.home else SERVER
                o0, m0 = core_seconds(mine), cpu_seconds(pids)
                g0, c0, s0, k0, w0 = cpu_seconds(backends), cpu_seconds(CARRIER_PIDS), cpu_seconds(pids, (12,)), resource.getrusage(resource.RUSAGE_CHILDREN), time.perf_counter()
                o = subprocess.run(['perf', 'stat', '-x,', '-o', f, '-e', ','.join(events), '-p', ','.join(map(str, pids)), '--'] + client, capture_output=True, text=True, env=env)
                wall, k1, g1, c1, s1 = time.perf_counter() - w0, resource.getrusage(resource.RUSAGE_CHILDREN), cpu_seconds(backends), cpu_seconds(CARRIER_PIDS), cpu_seconds(pids, (12,))
                guests = max(0.0, (core_seconds(mine) - o0 - (cpu_seconds(pids) - m0)) / (wall * len(mine)))
                if 'sys_perf_event_open' not in o.stderr:
                    break
        finally:
            done.set()
            w.join()
        j = dict(zip(o.stdout.split()[0::2], o.stdout.split()[1::2]))
        if self.dead() or o.returncode != 0 or j.get('requests') != str(size):
            raise Broke('broke under load', 'exit %s | the client: %s | %s' % (self.dead(), (o.stderr or o.stdout)[-200:].replace('\r', '').replace('\n', ' '), self.tail()))
        c, whole = {}, True
        for l in open(f):
            x = l.strip().split(',')
            if len(x) > 4 and x[0].replace('.', '').isdigit():
                c[x[2].split(':')[0]] = float(x[0])
                whole = whole and float(x[4] or 0) > 99.9
        if len(c) < len(events):
            raise Broke('broke under load', 'perf: ' + open(f).read()[-160:].replace('\n', ' '))
        self.total += size
        self.high = max(self.high, here[0])
        seconds = float(j['seconds'])
        return {'n': size, 'at': self.total, 'rate': size / seconds, 'p50': float(j['p50_us']), 'p99': float(j['p99_us']), 'mean': float(j['mean_us']), 'instructions': c.get('instructions', 0) / size, 'cycles': c.get('cycles', 0) / size,
                'kernel': (s1 - s0) * 1e6 / size, 'cpu': c['task-clock'] * 1e3 / size, 'whole': whole, 'private': here[0], 'guests': guests, **dict((e, c.get(e, 0) / size) for e in EVENTS),
                'client': (k1.ru_utime + k1.ru_stime - k0.ru_utime - k0.ru_stime) / (wall * len(CLIENT)), 'postgres': (g1 - g0) / (wall * max(1, len(cores_of(POSTGRES_CORES)))), 'postgres_us': (g1 - g0) * 1e6 / size,
                'carrier': (c1 - c0) / (wall * max(1, len(cores_of(CARRIER_CORES))))}

    def profile(self, event, per_request):
        data = os.path.join(self.folder, 'perf.data')
        requests = self.size * 4
        period = int(per_request * self.size / (SAMPLES_A_SECOND * WINDOW_SECONDS))
        client = ['taskset', '-c', CLIENT_CORES, LOAD, str(self.port), str(CONNECTIONS), str(requests), str(len(CLIENT))] + self.pairs
        for attempt in range(6):  # a thread that ends while perf attaches fails the call before the client is started
            o = subprocess.run(['perf', 'record', '-N', '-B', '-e', event + ':u', '-c', str(period), '-o', data, '-p', ','.join(map(str, self.pids())), '--'] + client, capture_output=True, text=True)
            if o.returncode == 0:
                break
        if self.dead() or o.returncode != 0:
            raise Broke('broke under load', 'perf record: exit %s: ' % o.returncode + (o.stderr + o.stdout)[-400:].replace('\n', ' '))
        report = subprocess.run(['perf', 'report', '-q', '-i', data, '--stdio', '--sort', 'dso,symbol', '-n', '-F', 'sample,dso,symbol', '--percent-limit', '0', '-g', 'none'], capture_output=True, text=True, errors='replace').stdout
        image_map, perf_map = self.binary + '.map', '/tmp/perf-%d.map' % self.pids()[0]
        addresses = []
        if os.path.exists(image_map) and os.path.exists(perf_map):
            addresses = subprocess.run(['perf', 'script', '-i', data, '-F', 'ip'], capture_output=True, text=True).stdout.split()
        by_stub = layers.count_stubs([int(x, 16) for x in addresses], perf_map, image_map)
        os.remove(data)
        self.total += requests
        named = b'.symtab' in subprocess.run(['readelf', '-S', '-W', self.binary], capture_output=True).stdout
        by_layer, by_symbol = layers.read_report(report.split('\n'), layers.kind_of(self.column if named else 'stripped'))
        scale = per_request / sum(by_layer.values())
        self.sampled.append('%s:%.2f' % (event, sum(by_layer.values()) * period / (per_request * requests)))
        with open(rows_file + '.symbols', 'a') as f:
            for (layer, symbol), samples in by_symbol.most_common(400):
                f.write('%s\t%s\t%s\t%s\t%d\t%s\n' % (self.test, self.column, event, layer, samples * scale, symbol[:200]))
            for name, samples in by_stub.most_common(100):
                f.write('%s\t%s\t%s\t%s\t%d\t%s\n' % (self.test, self.column, event, 'one stub', samples * scale, name))
        return dict((layer, samples * scale) for layer, samples in by_layer.items())

    def profile_callers(self, per_request):
        data = os.path.join(self.folder, 'perf.data')
        requests = self.size * 4
        period = int(per_request * self.size / (SAMPLES_A_SECOND * WINDOW_SECONDS))
        client = ['taskset', '-c', CLIENT_CORES, LOAD, str(self.port), str(CONNECTIONS), str(requests), str(len(CLIENT))] + self.pairs
        for attempt in range(6):
            o = subprocess.run(['perf', 'record', '-N', '-B', '-g', '-e', 'cycles:u', '-c', str(period), '-o', data, '-p', ','.join(map(str, self.pids())), '--'] + client, capture_output=True, text=True)
            if o.returncode == 0:
                break
        if self.dead() or o.returncode != 0:
            raise Broke('broke under load', 'perf record -g: exit %s: ' % o.returncode + (o.stderr + o.stdout)[-400:].replace('\n', ' '))
        counts = layers.read_call_chains(subprocess.run(['perf', 'script', '-i', data, '-F', 'ip,sym,dso'], capture_output=True, text=True, errors='replace').stdout.split('\n'))
        os.remove(data)
        self.total += requests
        return dict(('%s/%s' % (who, layer), samples * per_request / sum(counts.values())) for (layer, who), samples in counts.items())

    def warm(self):
        began, size, self.settled = time.perf_counter(), 2000, False
        while True:
            self.windows.append(self.window(size, counters=len(self.windows) >= 2))
            n = len(self.windows)
            size = 8000 if n == 1 else int(min(400000, max(4000, round(self.windows[-1]['rate'] * 1.0, -3))))
            last = [x['instructions'] for x in self.windows[-3:]]
            gone = time.perf_counter() - began
            if self.total >= self.least and n >= 5 and (max(last) - min(last)) * 100 <= WITHIN * min(last):
                self.settled = True
                break
            if gone > LONGEST:
                break
        self.curve, self.warm_seconds = [], time.perf_counter() - began
        self.longer = float(E(self.column.upper().replace('.', '_') + '_WARM_SECONDS', E('WARM_SECONDS', '0'))) - self.warm_seconds
        if self.longer <= 0 or not SPARE or CONTINUOUS:
            self.load_on()

    def load_on(self):
        began = time.perf_counter() - self.warm_seconds
        free = self.window(int(max(2000, round(self.windows[-1]['rate'], -3))), counters=False)
        while time.perf_counter() - began < self.warm_seconds + self.longer:
            self.curve.append('%d:%d' % (time.perf_counter() - began, free['rate']))
            free = self.window(int(max(2000, round(free['rate'] * 4, -3))), counters=False)
            self.loaded.append((time.perf_counter() - began, free))
        self.curve.append('%d:%d' % (time.perf_counter() - began, free['rate']))
        self.size = int(min(1000000, max(2000, round(free['rate'] * WINDOW_SECONDS, -3))))
        self.warm_seconds, self.longer = time.perf_counter() - began, 0
        if CONTINUOUS:
            self.rounds = [w for at, w in self.loaded if at >= READ_FROM] or [free]
            self.counted = [self.window(self.size) for n in range(COUNTER_ROUNDS)]
            if LAYERS:
                last = self.counted[-1]
                self.layers = dict((event, self.profile(event, last[event])) for event in ('cycles', 'instructions'))
                if self.column.split('.')[0] == 'aot':
                    self.layers['asked'] = self.profile_callers(last['cycles'])
                kernel, cpu = (statistics.median(x[k] for x in self.rounds) for k in ('kernel', 'cpu'))
                self.layers['cycles']['kernel'] = last['cycles'] * kernel / (cpu - kernel)
            self.paced = [self.window(int(self.pace * PACED_SECONDS), self.pace, int(self.pace * PACED_LEAD)) for n in range(PACED_ROUNDS)]

    def move(self, cores):
        for pid in self.pids():
            subprocess.run(['taskset', '-a', '-p', '-c', cores, str(pid)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def confirmed(self):
        best = max(x['rate'] for x in self.rounds)
        return sum(1 for x in self.rounds if x['rate'] >= 0.97 * best) >= min(3, ROUNDS)

    def row(self, start):
        peak = sum(status(p, 'VmHWM') for p in self.pids()) / 1024
        threads = sum(status(p, 'Threads') for p in self.pids())
        time.sleep(SETTLE)
        settled_rss = sum(status(p, 'VmRSS') for p in self.pids()) / 1024
        settled_private = sum(rollup(p).get('Private', 0.0) for p in self.pids())
        self.end()
        best = max(x['rate'] for x in self.rounds)
        r = self.rounds if CONTINUOUS else [x for x in self.rounds if x['rate'] >= 0.9 * best]
        clean = [x for x in r if x['guests'] <= 0.01]
        left_out, r = len(r) - len(clean), clean or r
        e = self.windows[:2]

        def middle(k):
            return statistics.median(x[k] for x in r)
        rates = [x['rate'] for x in r]
        counted = self.counted or self.windows[-2:]
        row = {'requests_a_second': middle('rate'), 'p50_us': middle('p50'), 'p99_us': middle('p99'), 'instructions': statistics.median(x['instructions'] for x in counted), 'cycles': statistics.median(x['cycles'] for x in counted),
               'counted_requests_a_second': statistics.median(x['rate'] for x in counted), 'kernel_us': middle('kernel'), **dict((e, statistics.median(x[e] for x in counted)) for e in EVENTS),
               'cpu_us': middle('cpu'), 'peak_rss_mb': peak, 'private_mb': self.high, 'settled_rss_mb': settled_rss, 'settled_private_mb': settled_private, 'ready_rss_mb': self.ready_rss, 'ready_private_mb': self.ready_private, 'first_answer_ms': statistics.median(self.firsts) * 1e3,
               'server_busy': statistics.median(x['cpu'] * x['rate'] / 1e6 for x in r) / len(SERVER), 'client_busy': middle('client'), 'postgres_busy': middle('postgres'), 'postgres_us': middle('postgres_us'), 'carrier_busy': middle('carrier'),
               'guests': max(x['guests'] for x in r), 'spread_percent': (max(rates) - min(rates)) * 100 / statistics.median(rates), 'early_requests_a_second': sum(x['n'] for x in e) / sum(x['n'] / x['rate'] for x in e),
               'file_mb': os.path.getsize(self.binary) / 1e6, 'load': float(open('/proc/loadavg').read().split()[0]), 'warm_seconds': self.warm_seconds}
        if self.paced:
            row.update(paced_p50_us=min(x['p50'] for x in self.paced), paced_p99_us=min(x['p99'] for x in self.paced), paced_p999_us=min(x['p999'] for x in self.paced))
        limit = [k for k in ('client', 'postgres', 'carrier') if row[k + '_busy'] > 0.9]
        by_layer = dict(('layers_' + event, ' '.join('%s:%d' % x for x in cells.items())) for event, cells in self.layers.items())
        if self.sampled:
            by_layer['layers_sampled'] = ' '.join(self.sampled)
        words = {'requests': self.total, 'window': self.size, 'rounds': len(self.rounds), 'rounds_kept': len(r), 'processes': len(self.firsts) and (len(SERVER) if self.column.split('.')[0] in SINGLE_THREADED else 1), 'threads': threads, 'paced_rate': self.pace,
                 'connections': CONNECTIONS, 'pool': self.pool, 'body_bytes': len(self.body), 'body_md5': hashlib.md5(self.body).hexdigest()[:8], 'settled': 'yes' if self.settled else 'NO', 'counted': 'whole' if all(x['whole'] for x in counted) else 'MULTIPLEXED',
                 'limit': ','.join(limit) or 'server', 'confirmed': int(self.confirmed()), 'firsts_ms': ' '.join('%.1f' % (x * 1e3) for x in self.firsts), 'round_rates': ' '.join('%d' % x['rate'] for x in self.rounds),
                 'curve': ' '.join('%d:%d' % (x['at'], x['instructions']) for x in self.windows), 'rate_curve': ' '.join(self.curve), 'label': LABEL, 'start_number': start, 'windows_void': left_out, 'void': 'no' if clean else 'yes', **by_layer}
        print('%-24s %9.0f/s +-%2.0f%% p50 %6.0f p99 %7.0f us | %8.0f instructions %8.0f cycles %7.2f us CPU (kernel %6.2f) | RSS ready %6.1f peak %6.1f private %6.1f MB | first %6.1f ms | busy: server %.2f client %.2f postgres %.2f carrier %.2f%s' % (
            self.name, row['requests_a_second'], row['spread_percent'] / 2, row['p50_us'], row['p99_us'], row['instructions'], row['cycles'], row['cpu_us'], row['kernel_us'], self.ready_rss, peak, self.high,
            row['first_answer_ms'], row['server_busy'], row['client_busy'], row['postgres_busy'], row['carrier_busy'], '' if self.settled else ' NOT SETTLED'), flush=True)
        return row, words


def guarded(s, step):
    try:
        step()
        return True
    except Broke as e:
        what, detail = e.args
    except Exception as e:
        what, detail = 'the instrument', repr(e)
    bad.append('%s: %s' % (s.name, what))
    print('%-24s %s: %s' % (s.name, what.upper(), str(detail)[:400]), flush=True)
    s.end()
    write('ROW\t%s\t%s\t%d\tfailed=%s\tlabel=%s' % (s.test, s.column, len(SERVER), what, LABEL))
    return False


BY_START = ('requests_a_second', 'cycles', 'instructions', 'cpu_us', 'peak_rss_mb', 'ready_rss_mb', 'private_mb', 'p99_us')
columns = columns.split(',')
for test in tests.split(','):
    stand = {}
    for start in range(LOADED_STARTS):
        servers, turn = [], start % len(columns)
        if CONTINUOUS:
            def life(s):
                if guarded(s, s.start) and guarded(s, s.warm):
                    guarded(s, lambda: stand.setdefault(s.column, []).append(s.row(start)))
            alike = [[c for c in columns if (c.split('.')[0] in SINGLE_THREADED) == single] for single in (True, False)]
            if E('TOGETHER', ''):
                alike = [g.split('+') for g in E('TOGETHER', '').split('/')]
            for kind in alike:
                for k in range(0, len(kind), len(SPARE) or 1):
                    homes = SPARE[start % len(SPARE):] + SPARE[:start % len(SPARE)] if SPARE else [None]
                    threads = [threading.Thread(target=life, args=(Server(test, c, home),)) for c, home in zip(kind[k:k + len(homes)], homes)]
                    for t in threads:
                        t.start()
                    for t in threads:
                        t.join()
            continue
        for column in columns[turn:] + columns[:turn]:
            s = Server(test, column)
            if guarded(s, s.start) and guarded(s, s.warm):
                s.stop()
                servers.append(s)
        waiting = [s for s in servers if s.longer > 0]
        while waiting:
            group, waiting, held = waiting[:len(SPARE)], waiting[len(SPARE):], {}
            for core, s in zip(SPARE, group):
                s.move(core)
                s.go_on()
            threads = [threading.Thread(target=lambda s=s: held.__setitem__(s, guarded(s, s.load_on))) for s in group]
            for t in threads:
                t.start()
            for t in threads:
                t.join()
            for s in group:
                if held.get(s):
                    s.move(SERVER_CORES)
                    s.stop()
                else:
                    servers.remove(s)
        for n in range(ROUNDS_MOST):
            if n >= ROUNDS and all(s.confirmed() for s in servers):
                break
            for s in list(servers):
                s.go_on()
                if guarded(s, lambda: s.rounds.append(s.window(s.size, counters=False))):
                    s.stop()
                else:
                    servers.remove(s)
        for n in range(COUNTER_ROUNDS):
            for s in list(servers):
                s.go_on()
                if guarded(s, lambda: s.counted.append(s.window(s.size))):
                    s.stop()
                else:
                    servers.remove(s)
        for n in range(PACED_ROUNDS):
            for s in list(servers):
                s.go_on()
                if guarded(s, lambda: s.paced.append(s.window(int(s.pace * PACED_SECONDS), s.pace, int(s.pace * PACED_LEAD)))):
                    s.stop()
                else:
                    servers.remove(s)
        for s in servers:
            s.go_on()
            guarded(s, lambda: stand.setdefault(s.column, []).append(s.row(start)))
    for column in columns:
        if column not in stand:
            continue
        starts = stand[column]
        row = dict((k, statistics.median(s[0][k] for s in starts)) for k in starts[-1][0])
        words = dict(starts[-1][1])
        for k, worst in (('settled', 'NO'), ('counted', 'MULTIPLEXED'), ('void', 'yes')):
            if any(s[1][k] == worst for s in starts):
                words[k] = worst
        words['limit'] = ','.join(sorted(set(x for s in starts for x in s[1]['limit'].split(',')) - ({'server'} if any(s[1]['limit'] != 'server' for s in starts) else set())))
        words['firsts_ms'] = ' '.join(s[1]['firsts_ms'] for s in starts)
        row['first_answer_ms'] = statistics.median(float(x) for x in words['firsts_ms'].split())
        words.update(loaded_starts=len(starts), **dict(('start_' + k, ' '.join('%.2f' % s[0][k] for s in starts)) for k in BY_START))
        del words['start_number']
        write('ROW\t%s\t%s\t%d\t%s' % (test, column, len(SERVER), '\t'.join('%s=%s' % (k, ('%.2f' % v) if isinstance(v, float) else v) for k, v in list(row.items()) + list(words.items()))))
print('MEASURE %s: ' % SERVER_CORES + ('FAIL: ' + ' | '.join(bad)[:600] if bad else 'DONE'))
